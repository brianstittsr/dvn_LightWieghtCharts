import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** $1,234.56 with a leading minus for negatives. */
export const usd = (v: number): string =>
  `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Always-signed variant of {@link usd} (+$1.00 / -$1.00). */
export const signed = (v: number): string => `${v >= 0 ? "+" : "-"}${usd(v).replace("-", "")}`;
