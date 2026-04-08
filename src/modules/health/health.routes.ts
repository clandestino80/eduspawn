import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { getHealthSnapshot } from "./health.service";

export const healthRouter = Router();

healthRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const snapshot = await getHealthSnapshot();
    const statusCode = snapshot.status === "ok" ? 200 : 503;
    res.status(statusCode).json({
      success: snapshot.status === "ok",
      data: {
        service: "eduspawn-api",
        ...snapshot,
      },
    });
  }),
);
