import { Router, type IRouter } from "express";
import diagnosticRouter from "./diagnostic";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(diagnosticRouter);

export default router;
