// Correct an observed nonstandard Korean rendering only when the English
// source supplies its meaning. Explicit quoted words and glossary choices win.
export function normalizeTranslation(text,{language,task='translate',text:source='',glossary=''}={}){
 if(language==='en-US'&&task==='translate'&&/\bagreement\b/i.test(source)&&!source.includes('합약서')&&!glossary.includes('합약서'))return text.replaceAll('합약서','합의서');
 return text;
}
