/**
 * Zod schemas for auth boundaries. Validated in the register/login routes before
 * anything touches the DB — malformed or oversized input is rejected at the door.
 */

import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name").max(120),
  email: z.email("Please enter a valid email address").max(200),
  // Minimum 8 is the floor; we don't cap low, but we DO cap high (bcrypt only
  // uses the first 72 bytes, and an unbounded password is a DoS vector).
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be 72 characters or fewer"),
});

export const loginSchema = z.object({
  email: z.email("Please enter a valid email address").max(200),
  password: z.string().min(1, "Please enter your password").max(72),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
