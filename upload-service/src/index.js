import { createAuthorizationService } from "./authorization.js";
import { loadConfig } from "./config.js";
import { createUploadServer } from "./server.js";

const config = loadConfig();
const authorizationService = createAuthorizationService({ config });
const server = createUploadServer({ config, authorizationService });

server.listen(config.port, config.host, () => {
  // Log configuration state only. Never log credentials, signatures, or file metadata.
  console.log(`Upload authorization service listening on http://${config.host}:${config.port}`);
  console.log(`Pinata provider configured: ${Boolean(config.pinataJwt)}`);
});
