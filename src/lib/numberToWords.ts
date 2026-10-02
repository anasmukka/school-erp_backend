/**
 * Indian Number to Words Converter for Currency (INR)
 * Converts numeric amounts into "Rupees ... Only" in the Indian numbering system
 * (Crores, Lakhs, Thousands, Hundreds, Tens, Units).
 */

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

function convertBelowThousand(num: number): string {
  let result = "";
  if (num >= 100) {
    result += ONES[Math.floor(num / 100)] + " Hundred ";
    num %= 100;
  }
  if (num >= 20) {
    result += TENS[Math.floor(num / 10)] + " ";
    num %= 10;
  }
  if (num > 0) {
    result += ONES[num] + " ";
  }
  return result.trim();
}

/**
 * Converts a non-negative integer into words following the Indian numbering system.
 */
export function convertIntegerToIndianWords(num: number): string {
  if (num === 0) return "Zero";

  const crore = Math.floor(num / 10000000);
  num %= 10000000;

  const lakh = Math.floor(num / 100000);
  num %= 100000;

  const thousand = Math.floor(num / 1000);
  num %= 1000;

  const remainder = num;

  const parts: string[] = [];

  if (crore > 0) {
    parts.push(convertIntegerToIndianWords(crore) + " Crore");
  }
  if (lakh > 0) {
    parts.push(convertBelowThousand(lakh) + " Lakh");
  }
  if (thousand > 0) {
    parts.push(convertBelowThousand(thousand) + " Thousand");
  }
  if (remainder > 0) {
    parts.push(convertBelowThousand(remainder));
  }

  return parts.join(" ").trim();
}

/**
 * Converts a currency amount in INR to formal words.
 * Example:
 * 15000 -> "Rupees Fifteen Thousand Only"
 * 60000 -> "Rupees Sixty Thousand Only"
 * 125500.50 -> "Rupees One Lakh Twenty Five Thousand Five Hundred and Fifty Paise Only"
 */
export function amountInWordsINR(amount: number): string {
  if (isNaN(amount) || amount === null || amount === undefined) {
    return "Rupees Zero Only";
  }

  const rounded = Math.round(Math.abs(amount) * 100) / 100;
  const integerPart = Math.floor(rounded);
  const paisePart = Math.round((rounded - integerPart) * 100);

  const rupeeWords = convertIntegerToIndianWords(integerPart);

  let result = `Rupees ${rupeeWords}`;

  if (paisePart > 0) {
    const paiseWords = convertBelowThousand(paisePart);
    result += ` and ${paiseWords} Paise`;
  }

  result += " Only";
  return result;
}
