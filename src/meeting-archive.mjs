export const ARCHIVE_KEY = 'habi-meetings-v1';
export function loadMeetings(storage) {
  try {
    const data = JSON.parse(storage.getItem(ARCHIVE_KEY) || 'null');
    if (data?.version !== 1 || !Array.isArray(data.sessions)) return [];
    return data.sessions.filter(session => session && typeof session.id === 'string' && typeof session.createdAt === 'string' && Number.isFinite(Date.parse(session.createdAt)) && Array.isArray(session.records))
      .map(session => ({ glossary:typeof session.glossary==='string'?session.glossary.slice(0,2000):'', purpose:typeof session.purpose==='string'?session.purpose.slice(0,300):'', id: session.id, createdAt: session.createdAt, updatedAt: session.updatedAt || session.createdAt,
        speeches: Array.isArray(session.speeches) ? session.speeches.filter(item => item && typeof item.id === 'string' && typeof item.ko === 'string').map(item => ({ ...item, en: typeof item.en === 'string' ? item.en : '', status: item.status === 'draft' ? 'draft' : item.status === 'complete' && typeof item.en === 'string' && item.en.trim() ? 'complete' : 'error', error: item.status === 'draft' ? '' : item.status === 'complete' && typeof item.en === 'string' && item.en.trim() ? '' : '작성이 중단됐어요. 다시 변환해 주세요.' })) : [],
        replies: Array.isArray(session.replies) ? session.replies.filter(item => item && typeof item.ko === 'string' && typeof item.en === 'string').slice(0, 3) : [],
        records: session.records.filter(row => row && typeof row.id === 'string' && ['en-US', 'ko-KR'].includes(row.language) && typeof row.original === 'string').map((row, index) => ({
          ...row, translation: typeof row.translation === 'string' ? row.translation : '', createdAt: Number(row.createdAt) || Date.parse(session.createdAt) + index,
          status: row.status === 'complete' && (row.language === 'ko-KR' || row.transcriptOnly === true || typeof row.translation === 'string' && row.translation.trim()) ? 'complete' : 'error', error: row.status === 'complete' && (row.language === 'ko-KR' || row.transcriptOnly === true || typeof row.translation === 'string' && row.translation.trim()) ? '' : '번역이 완료되지 않은 기록이에요. 다시 번역해 주세요.',
        })),
      })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch { return []; }
}
export function mergeMeeting(sessions, meta, records, now = new Date().toISOString()) {
  if (!records.length && !meta.speeches?.length) return sessions;
  return [{ ...meta, updatedAt: now, records: records.map(row => ({ ...row })) }, ...sessions.filter(session => session.id !== meta.id)]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function saveMeetings(storage, sessions) { storage.setItem(ARCHIVE_KEY, JSON.stringify({ version: 1, sessions })); }
export function detectCaptionLanguage(text, fallback = 'en-US') {
  const korean = (text.match(/[가-힣]/gu) || []).length;
  const latin = (text.match(/[a-z]/giu) || []).length;
  return (korean>0 && latin===0) || (korean >= 2 && korean >= latin * .15) ? 'ko-KR' : latin ? 'en-US' : fallback === 'auto' ? 'en-US' : fallback;
}

export function supportedCaptionWord(text, languageCode='') {
  const code=languageCode.toLowerCase().split('-')[0];
  return (!code || code==='en' || code==='ko') &&
    !/[^\p{Script=Latin}\p{Script=Hangul}\p{Script=Common}\p{Script=Inherited}]/u.test(text);
}
