import { z } from "zod";

export const registerBodySchema = z.object({
  email: z.string().trim().email(),
  username: z.string().trim().min(3).max(32),
  password: z.string().min(8).max(128),
});

export const loginBodySchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export const googleAuthBodySchema = z.object({
  idToken: z.string().trim().min(1),
});

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type GoogleAuthBody = z.infer<typeof googleAuthBodySchema>;
