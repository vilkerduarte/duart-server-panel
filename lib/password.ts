const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
// Símbolos que não quebram connection strings (sem @ # % / : ?) nem shells/SQL (sem aspas, \ $ `).
const SYMBOLS = '!*-_.+=';
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

/** Índice aleatório uniforme em [0, max) via crypto, sem viés de módulo. */
function randomIndex(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % max;
}

/** Senha com letras maiúsculas/minúsculas, números e símbolos seguros; garante ao menos um de cada. */
export function generatePassword(length = 12): string {
  const chars = [UPPER, LOWER, DIGITS, SYMBOLS].map(set => set[randomIndex(set.length)]);
  while (chars.length < length) chars.push(ALL[randomIndex(ALL.length)]);

  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
