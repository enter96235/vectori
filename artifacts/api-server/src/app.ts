import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

const staticRoot = process.env.STATIC_ROOT;
if (staticRoot) {
  const resolvedStaticRoot = path.resolve(staticRoot);
  app.use(express.static(resolvedStaticRoot));
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(resolvedStaticRoot, "index.html"));
  });
}

export default app;
