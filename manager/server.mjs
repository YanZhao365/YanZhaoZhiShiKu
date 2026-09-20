import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec=promisify(execFile);const here=path.dirname(fileURLToPath(import.meta.url));const root=path.resolve(here,"..");const managerPublic=path.join(here,"public");const dataFile=path.join(root,"data","knowledge.json");const uploadDir=path.join(root,"uploads");const localConfigFile=path.join(here,"local-config.json");const port=Number(process.env.YANZHAO_MANAGER_PORT)||4178;
const deepSeekModel="deepseek-flash";
const types={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".pdf":"application/pdf"};
function send(res,status,body,type="application/json; charset=utf-8"){res.writeHead(status,{"content-type":type,"cache-control":"no-store"});res.end(typeof body==="string"||Buffer.isBuffer(body)?body:JSON.stringify(body))}
async function body(req){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>36*1024*1024)throw new Error("文件太大，单个附件请控制在25MB以内");chunks.push(chunk)}return JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}")}
function safeName(name){return path.basename(name).replace(/[^\p{L}\p{N}._-]+/gu,"-").slice(0,120)||`file-${Date.now()}`}
async function staticFile(res,base,relative){const target=path.resolve(base,relative||"index.html");if(!target.startsWith(path.resolve(base)))return send(res,403,"禁止访问","text/plain");try{const stat=await fs.stat(target);const file=stat.isDirectory()?path.join(target,"index.html"):target;send(res,200,await fs.readFile(file),types[path.extname(file).toLowerCase()]||"application/octet-stream")}catch{send(res,404,"未找到页面","text/plain; charset=utf-8")}}
async function git(args){
  const bundledRoot=path.join(process.env.USERPROFILE||"",".cache","codex-runtimes","codex-primary-runtime","dependencies","native","git");
  const bundledGit=path.join(bundledRoot,"cmd","git.exe");
  const candidates=[
    {executable:"git",env:process.env},
    {executable:bundledGit,env:{...process.env,GIT_EXEC_PATH:path.join(bundledRoot,"mingw64","bin")}},
  ];
  let lastError;
  for(const [index,candidate] of candidates.entries()){
    try{return await exec(candidate.executable,args,{cwd:root,windowsHide:true,maxBuffer:1024*1024,env:candidate.env})}
    catch(error){lastError=error;if(index===candidates.length-1)throw error}
  }
  throw lastError;
}
async function readLocalConfig(){
  try{return JSON.parse(await fs.readFile(localConfigFile,"utf8"))}
  catch(error){if(error.code==="ENOENT")return {};throw error}
}
function publicAiConfig(config){
  const apiKey=String(config.apiKey||"");
  return {ok:true,configured:Boolean(apiKey),maskedKey:apiKey?`${apiKey.slice(0,3)}••••${apiKey.slice(-4)}`:"",model:deepSeekModel};
}
function cleanJsonReply(content){
  return String(content||"").trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/i,"");
}
async function organizeWithDeepSeek(value){
  const config=await readLocalConfig();
  if(!config.apiKey)throw new Error("尚未配置 DeepSeek API Key，请先点击右上角“AI 设置”");
  const rawBody=String(value.body||"").trim();
  if(rawBody.length<10)throw new Error("正文内容太少，请至少写 10 个字后再使用 AI 整理");
  if(rawBody.length>50000)throw new Error("正文超过 50,000 字，请分成多篇文章整理");
  const sections=Array.isArray(value.sections)?value.sections.slice(0,100).map(item=>({id:String(item.id||""),title:String(item.title||"").slice(0,100)})).filter(item=>item.id&&item.title):[];
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),90000);
  let response;
  try{
    response=await fetch("https://api.deepseek.com/chat/completions",{
      method:"POST",
      headers:{"content-type":"application/json","authorization":`Bearer ${config.apiKey}`},
      body:JSON.stringify({
        model:deepSeekModel,
        messages:[
          {role:"system",content:"你是沿昭个人知识库的中文编辑助手。请忠实整理用户原文，不得编造事实、数据、引用或经历；保留 Markdown、公式、代码、链接和用户原意；修正错别字与结构，生成简洁标题和摘要，并从用户提供的目录中推荐一个目录。只返回合法 JSON，不要添加解释。JSON 格式必须为：{\"title\":\"\",\"summary\":\"\",\"body\":\"\",\"recommendedSectionId\":\"\"}。"},
          {role:"user",content:JSON.stringify({availableSections:sections,currentSectionId:String(value.sectionId||""),currentTitle:String(value.title||"").slice(0,200),currentSummary:String(value.summary||"").slice(0,1000),rawBody})}
        ],
        response_format:{type:"json_object"},
        temperature:0.2,
        max_tokens:2000
      }),
      signal:controller.signal
    });
  }catch(error){
    if(error.name==="AbortError")throw new Error("连接 DeepSeek 超时，请检查网络后重试");
    throw new Error("无法连接 DeepSeek，请检查网络后重试");
  }finally{clearTimeout(timeout)}
  const result=await response.json().catch(()=>({}));
  if(!response.ok){
    const known={401:"DeepSeek API Key 无效，请在“AI 设置”中重新填写",402:"DeepSeek 账户余额不足，请充值后重试",429:"DeepSeek 请求过于频繁，请稍后重试"};
    throw new Error(known[response.status]||String(result.error?.message||`DeepSeek 请求失败（${response.status}）`));
  }
  let suggestion;
  try{suggestion=JSON.parse(cleanJsonReply(result.choices?.[0]?.message?.content))}
  catch{throw new Error("DeepSeek 返回内容无法解析，请重试")}
  const validSectionIds=new Set(sections.map(item=>item.id));
  const title=String(suggestion.title||"").trim().slice(0,120);
  const summary=String(suggestion.summary||"").trim().slice(0,500);
  const organizedBody=String(suggestion.body||"").trim();
  if(!title||!summary||!organizedBody)throw new Error("DeepSeek 返回的文章不完整，请重试");
  const recommended=String(suggestion.recommendedSectionId||"");
  return {ok:true,suggestion:{title,summary,body:organizedBody,recommendedSectionId:validSectionIds.has(recommended)?recommended:String(value.sectionId||"")},usage:result.usage||null};
}
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,"http://127.0.0.1");if(url.pathname==="/api/data"&&req.method==="GET")return send(res,200,await fs.readFile(dataFile,"utf8"),"application/json; charset=utf-8");if(url.pathname==="/api/data"&&req.method==="POST"){const value=await body(req);if(!Array.isArray(value.sections)||!Array.isArray(value.articles))throw new Error("知识库数据格式不正确");const temp=`${dataFile}.tmp`;await fs.writeFile(temp,JSON.stringify(value,null,2),"utf8");await fs.rename(temp,dataFile);return send(res,200,{ok:true})}if(url.pathname==="/api/upload"&&req.method==="POST"){const value=await body(req);const name=safeName(value.name);const match=String(value.data||"").match(/^data:[^;]+;base64,(.+)$/);if(!match)throw new Error("附件内容无效");await fs.mkdir(uploadDir,{recursive:true});const final=`${Date.now()}-${name}`;await fs.writeFile(path.join(uploadDir,final),Buffer.from(match[1],"base64"));return send(res,200,{ok:true,path:`uploads/${final}`})}if(url.pathname==="/api/ai-config"&&req.method==="GET")return send(res,200,publicAiConfig(await readLocalConfig()));if(url.pathname==="/api/ai-config"&&req.method==="POST"){const value=await body(req);const current=await readLocalConfig();const apiKey=String(value.apiKey||"").trim()||String(current.apiKey||"");if(!apiKey)throw new Error("请输入 DeepSeek API Key");if(apiKey.length<20||/\s/.test(apiKey))throw new Error("API Key 格式不正确，请重新复制完整密钥");const temp=`${localConfigFile}.tmp`;await fs.writeFile(temp,JSON.stringify({apiKey,model:deepSeekModel},null,2),"utf8");await fs.rename(temp,localConfigFile);return send(res,200,publicAiConfig({apiKey,model:deepSeekModel}))}if(url.pathname==="/api/ai/organize"&&req.method==="POST")return send(res,200,await organizeWithDeepSeek(await body(req)));if(url.pathname==="/api/status"){const result=await git(["status","--short"]);return send(res,200,{changed:Boolean(result.stdout.trim()),details:result.stdout.trim()})}if(url.pathname==="/api/publish"&&req.method==="POST"){await git(["config","user.name","YanZhao365"]);await git(["config","user.email","YanZhao365@users.noreply.github.com"]);await git(["add","."]);try{await git(["commit","-m",`更新知识库 ${new Date().toLocaleString("zh-CN")}`])}catch(error){if(!String(error.stderr||"").includes("nothing to commit"))throw error}await git(["push","-u","origin","HEAD:main"]);return send(res,200,{ok:true,message:"发布成功，线上网站即将更新"})}if(url.pathname==="/manager"||url.pathname==="/manager/")return staticFile(res,managerPublic,"index.html");if(url.pathname.startsWith("/manager/"))return staticFile(res,managerPublic,url.pathname.slice(9));if(url.pathname.includes(".git")||url.pathname.startsWith("/manager/server"))return send(res,403,"禁止访问","text/plain");return staticFile(res,root,url.pathname.slice(1)||"index.html")}catch(error){send(res,500,{ok:false,error:error.message,details:String(error.stderr||"").trim()})}});
server.listen(port,"127.0.0.1",()=>console.log(`沿昭知识库管理器已启动：http://127.0.0.1:${port}/manager/`));
