import { Router } from "express";

/**
 * Future: JWT/session, OAuth, RBAC. Mount guards and controllers here.
 */
export const authRouter = Router();

authRouter.get("/status", (_req, res) => {
  res.status(200).json({
    success: true,
    data: { module: "auth", state: "scaffolded" },
  });
});
