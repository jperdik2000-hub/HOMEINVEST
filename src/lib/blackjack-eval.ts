// Client-safe blackjack helpers. Server is still authoritative for all money-affecting logic.
// Cards are 2-char strings like "As", "Td", "Kh", "2c".

export function cardValue(card: string): number {
  const r = card[0];
  if (r === "A") return 11;
  if (r === "K" || r === "Q" || r === "J" || r === "T") return 10;
  return parseInt(r, 10);
}

// Returns {total, soft}. Soft means an Ace is counted as 11.
export function handValue(cards: string[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const v = cardValue(c);
    total += v;
    if (c[0] === "A") aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

export function isBlackjack(cards: string[]) {
  return cards.length === 2 && handValue(cards).total === 21;
}

export function isBust(cards: string[]) {
  return handValue(cards).total > 21;
}

export function displayTotal(cards: string[]): string {
  const { total, soft } = handValue(cards);
  if (soft && total !== 21) {
    return `${total - 10}/${total}`;
  }
  return String(total);
}

export function canSplit(cards: string[]): boolean {
  if (cards.length !== 2) return false;
  const a = cards[0][0];
  const b = cards[1][0];
  // 10, J, Q, K all count as 10 so any pair of them can split
  const ten = (r: string) => r === "T" || r === "J" || r === "Q" || r === "K";
  if (ten(a) && ten(b)) return true;
  return a === b;
}