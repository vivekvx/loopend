const technicalTimestamp =
  /\b(?:\d{4}-\d{2}-\d{2}T)?\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;

export function userFacingCopy(value: string) {
  return value
    .replace(
      /(?:the )?(?:email|message) from \d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z/gi,
      (match) =>
        match.startsWith('The ') ? 'The recent email' : 'the recent email',
    )
    .replace(technicalTimestamp, 'recently')
    .replace(/Additional confirmation from recently/gi, 'A recent follow-up');
}

export function boundedExcerpt(value: string, limit = 700) {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > limit
    ? `${compact.slice(0, limit).trimEnd()}...`
    : compact;
}
