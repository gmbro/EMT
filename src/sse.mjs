export async function* readSSE(body, {eventTypes = false} = {}) {
  if (!body) throw new Error('응답 스트림이 없어요.');
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '', data = [], eventName = '';
  const parse = payload => {const value=JSON.parse(payload);return eventTypes && eventName && !value.event_type ? {...value,event_type:eventName} : value;};
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, ''); buffer = buffer.slice(newline + 1);
        if (!line) { if (data.length) { const payload = data.join('\n'); data = []; if (payload === '[DONE]') return; yield parse(payload); eventName = ''; } }
        else if(line.startsWith('event:')) eventName=line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (done) break;
      if (buffer.length > 131072) throw new Error('응답 형식이 올바르지 않아요.');
    }
    if (buffer.startsWith('data:')) data.push(buffer.slice(5).trimStart());
    if (data.length && data.join('\n') !== '[DONE]') yield parse(data.join('\n'));
  } finally { try { await reader.cancel(); } catch {} reader.releaseLock(); }
}
