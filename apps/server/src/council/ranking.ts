import type { AggregateRank, Stage1Response, Stage2Aggregate, Stage2Review } from "@synod/contracts";

/** "Response A", "Response B", ... in the order given. */
export function assignLabels(responses: Stage1Response[]): { label: string; response: Stage1Response }[] {
  return responses.map((response, i) => ({ label: `Response ${labelLetter(i)}`, response }));
}

function labelLetter(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : `Z${index - 25}`;
}

/** Parse the "FINAL RANKING:" section; falls back to label order of appearance. */
export function parseRanking(text: string, validLabels: string[]): string[] {
  const valid = new Set(validLabels);
  const marker = text.lastIndexOf("FINAL RANKING:");
  const section = marker >= 0 ? text.slice(marker + "FINAL RANKING:".length) : text;
  const numbered = [...section.matchAll(/^\s*\d+[.)]\s*\**(Response [A-Z]\d*)\b/gm)].map((m) => m[1]);
  const found = numbered.length ? numbered : [...section.matchAll(/Response [A-Z]\d*\b/g)].map((m) => m[0]);
  const seen = new Set<string>();
  return found.filter((label) => valid.has(label) && !seen.has(label) && seen.add(label));
}

/** Average rank position per member across all reviews (lower is better). */
export function aggregateRankings(reviews: Stage2Review[], labelled: { label: string; response: Stage1Response }[]): Stage2Aggregate {
  const labelToMemberId = Object.fromEntries(labelled.map((l) => [l.label, l.response.memberId]));
  const positions = new Map<string, number[]>();
  for (const review of reviews) {
    review.ranking.forEach((label, i) => {
      const memberId = labelToMemberId[label];
      if (!memberId) return;
      positions.set(memberId, [...(positions.get(memberId) ?? []), i + 1]);
    });
  }
  const rankings: AggregateRank[] = labelled
    .map(({ response }) => {
      const ranks = positions.get(response.memberId) ?? [];
      return {
        memberId: response.memberId,
        label: response.label,
        averageRank: ranks.length ? Math.round((ranks.reduce((a, b) => a + b, 0) / ranks.length) * 100) / 100 : Number.POSITIVE_INFINITY,
        votes: ranks.length
      };
    })
    .sort((a, b) => a.averageRank - b.averageRank);
  // JSON can't carry Infinity; unranked members sort last with rank 0 votes.
  return { labelToMemberId, rankings: rankings.map((r) => (Number.isFinite(r.averageRank) ? r : { ...r, averageRank: 0 })) };
}
