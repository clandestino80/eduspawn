import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth.middleware";
import { googleAuthController, loginController, meController, registerController } from "./auth.controller";

export const authRouter = Router();

authRouter.post("/register", asyncHandler(registerController));
authRouter.post("/login", asyncHandler(loginController));
authRouter.post("/google", asyncHandler(googleAuthController));
authRouter.get("/me", requireAuth, asyncHandler(meController));
