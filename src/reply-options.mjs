// Conservative product guard, not a semantic guarantee. User-authored speech is
// translated separately; suggested guides must never make an offer of action.
export function validateReplyOptions(replies) {
  const unsafe = /\b(?:I|we)\s+(?:will|shall|promise|commit)\b|\b(?:I'll|we'll)\b|\b(?:I|we)\s+(?:can|could)\s+(?:approve|finali[sz]e|send|pay|deliver|complete)\b|(?:승인|확정|완료|결제)(?:해\s*)?(?:드리겠습니다|하겠습니다|할\s*수\s*있습니다|드릴\s*수\s*있습니다)|(?:보내|전달|업데이트|말씀|알려)(?:해\s*)?(?:드리겠습니다|하겠습니다)/iu;
  if(replies.some(r=>unsafe.test(`${r.ko}\n${r.en}`)))throw new Error('확인되지 않은 약속이 포함되어 제안을 표시하지 않았어요. 새로 제안을 눌러주세요.');
  return replies;
}

// No additional paid retry when a generated guide invents a commitment.
// These are explicitly labelled clarification templates, never an AI answer.
export function clarificationFallback(text) {
  const choices=[
    [/\bsecurity|privacy|compliance\b/i,'보안 검토의 범위와 완료 기준을 구체적으로 설명해 주시겠어요?','Could you clarify the scope and completion criteria for the security review?'],
    [/\bagenda\b/i,'회의 안건에 어떤 항목이 포함되어야 하는지 알려주시겠어요?','Could you specify which topics the meeting agenda should cover?'],
    [/\bbudget|cost|price|payment\b/i,'말씀하신 금액에 어떤 항목이 포함되는지 확인해 주시겠어요?','Could you clarify what is included in the amount you mentioned?'],
    [/\bdeadline|schedule|timeline\b/i,'일정에 영향을 주는 선행 조건을 설명해 주시겠어요?','Could you clarify which prerequisites affect the timeline?'],
  ];
  const match=choices.find(([pattern])=>pattern.test(text));
  return {ko:match?.[1]||'방금 말씀하신 내용에서 우선 확인해야 할 쟁점을 구체적으로 설명해 주시겠어요?',en:match?.[2]||'Could you clarify which specific issue in your last point we should address first?',fallback:true};
}
