export function exportLines(meeting,{content='both',timestamps=true,guides=false,speeches=false}={}) {
 const lines=['석변의 미팅 뿌시기',new Date(meeting.activeSessionDate).toLocaleString('ko-KR'),''];
 for(const row of meeting.records){
  if(timestamps)lines.push(new Date(row.createdAt).toLocaleTimeString('ko-KR'));
  if(content!=='translation')lines.push(row.original);
  if(content!=='original')lines.push(row.language==='ko-KR'? (content==='translation'?row.original:'') : row.translation||'(번역 미완료)');
  lines.push('');
 }
 if(guides&&meeting.replies.length)lines.push('[추천 답변 · 실제 발언 아님]',...meeting.replies.flatMap(r=>[r.ko,r.en,'']));
 if(speeches&&meeting.speeches.length)lines.push('[내 발언 초안 · 실제 발언 아님]',...meeting.speeches.flatMap(r=>[r.ko,r.en||'(작성 미완료)','']));
 return lines;
}
export async function meetingExport(meeting,options={}){
 const lines=exportLines(meeting,options),format=options.format||'txt';
 if(format==='docx'){
  const {Document,Packer,Paragraph,TextRun}=await import('docx');
  return Packer.toBlob(new Document({sections:[{children:lines.map(text=>new Paragraph({children:[new TextRun({text,size:22,font:'Arial'})],spacing:{after:100}}))}]}));
 }
 if(format==='json')return new Blob([JSON.stringify({version:1,date:meeting.activeSessionDate,records:meeting.records.map(r=>({id:r.id,...(options.timestamps===false?{}:{createdAt:r.createdAt}),language:r.language,...(options.content!=='translation'?{original:r.original}:{}),...(options.content!=='original'?{translation:r.language==='ko-KR'?r.original:r.translation,status:r.status}:{} )})),...(options.guides?{replies:meeting.replies}:{}),...(options.speeches?{speeches:meeting.speeches}:{})},null,2)],{type:'application/json'});
 return new Blob(['\ufeff'+lines.join('\n')],{type:'text/plain;charset=utf-8'});
}
