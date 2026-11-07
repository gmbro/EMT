export const LIVE_MODEL = 'models/gemini-3.5-transcribe-live';
const GOOGLE = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens';
export function liveSetup(target, resumeHandle, language='auto', vocabulary=[]) {
  if (!['en', 'ko'].includes(target)) throw new Error('지원하지 않는 통역 언어예요.');
  return { model: LIVE_MODEL, sessionResumption: resumeHandle ? { handle: resumeHandle } : {}, contextWindowCompression: { slidingWindow: {} }, inputAudioTranscription: { languageCodes: language === 'auto' ? ['en-US','ko-KR'] : [language], ...(vocabulary.length ? { customVocabulary:vocabulary } : {}) }, generationConfig: { responseModalities: ['TEXT'] } };
}
export async function createLiveToken(key, target, { fetchImpl = fetch, now = Date.now, signal, resumeHandle, language='auto', vocabulary=[], legacy=false } = {}) {
  const setup = legacy ? {model:'models/gemini-3.5-live-translate-preview',sessionResumption:resumeHandle?{handle:resumeHandle}:{},contextWindowCompression:{slidingWindow:{}},inputAudioTranscription:{},outputAudioTranscription:{},generationConfig:{responseModalities:['AUDIO'],translationConfig:{targetLanguageCode:target,echoTargetLanguage:false}}} : liveSetup(target, resumeHandle, language, vocabulary);
  const expireTime = new Date(now() + 30 * 60000).toISOString();
  const response = await fetchImpl(GOOGLE, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ uses: 1, expireTime, newSessionExpireTime: new Date(now() + 60000).toISOString(), bidiGenerateContentSetup: setup }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.name !== 'string') throw Object.assign(new Error(response.status === 402 ? 'Google 음성 API 크레딧을 확인해 주세요.' : response.status === 429 ? '실시간 음성 API 한도에 도달했어요. 잠시 후 다시 시작해 주세요.' : 'Google 실시간 음성 연결 권한을 확인해 주세요.'), { status: [402,429].includes(response.status) ? response.status : 503 });
  return { token: body.name, setup, expireTime };
}
export function createHandler({ getKey = () => process.env.google_api || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY, fetchImpl = fetch, now = Date.now } = {}) {
  const buckets = new Map();
  return async function handler(req, res) {
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    const send = (status, body) => { res.statusCode=status; res.setHeader('Content-Type','application/json; charset=utf-8'); res.end(JSON.stringify(body)); };
    if (req.method !== 'POST') { res.setHeader('Allow','POST'); return send(405,{error:'사이트에서 회의를 시작해 주세요.'}); }
    const allowed = [`https://${req.headers.host}`, ...(process.env.NODE_ENV !== 'production' ? [`http://${req.headers.host}`] : [])];
    if (!allowed.includes(req.headers.origin)) return send(403,{error:'사이트에서 회의를 시작해 주세요.'});
    if (!String(req.headers['content-type']).includes('application/json')) return send(415,{error:'JSON 요청만 지원해요.'});
    const ip=String(req.headers['x-forwarded-for']||'local').split(',')[0], bucket=buckets.get(ip)||{at:now(),count:0};
    if(now()-bucket.at>=60000){bucket.at=now();bucket.count=0;}
    if(++bucket.count>12)return send(429,{error:'잠시 후 다시 시작해 주세요.'});
    buckets.set(ip,bucket); if(buckets.size>1000)for(const [id,value] of buckets)if(now()-value.at>60000)buckets.delete(id);
    const key=getKey()?.trim(); if(!key)return send(503,{error:'Google API 키가 설정되지 않았어요.'});
    const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),12000);
    try{
      if(Number(req.headers['content-length'])>10000)return send(413,{error:'요청이 너무 길어요.'});
      let body=req.body;
      if(body===undefined){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>10000)return send(413,{error:'요청이 너무 길어요.'});}body=raw;}
      try{body=typeof body==='string'?JSON.parse(body):body;}catch{return send(400,{error:'요청 형식이 올바르지 않아요.'});}
      if(!body||Object.keys(body).some(field=>!['target','resumeHandle','language','vocabulary'].includes(field))||!['en','ko'].includes(body.target)||body.resumeHandle!==undefined&&(typeof body.resumeHandle!=='string'||!body.resumeHandle.length||body.resumeHandle.length>8000))return send(400,{error:'지원하지 않는 통역 요청이에요.'});
      if(body.language!==undefined&&!['auto','en-US','ko-KR'].includes(body.language)||body.vocabulary!==undefined&&(!Array.isArray(body.vocabulary)||body.vocabulary.length>80||body.vocabulary.some(word=>typeof word!=='string'||word.length>80)||body.vocabulary.join('').length>2000))return send(400,{error:'음성 언어·용어를 확인해 주세요.'});
      return send(200,await createLiveToken(key,body.target,{fetchImpl,now,signal:controller.signal,resumeHandle:body.resumeHandle,language:body.language,vocabulary:body.vocabulary,legacy:body.language===undefined&&body.vocabulary===undefined}));
    }catch(error){return send(error.status||503,{error:error.status?error.message:'실시간 음성 서버에 연결하지 못했어요. 다시 시작해 주세요.'});}
    finally{clearTimeout(timeout);}
  };
}
export default createHandler();
