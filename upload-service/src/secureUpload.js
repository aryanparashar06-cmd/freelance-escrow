import { removeQuarantine, receiveQuarantinedFile } from "./quarantine.js";
import { validateFileContent } from "./contentValidation.js";
import { scanFileWithClamAv } from "./scanner.js";
import { uploadFileToPinata } from "./pinata.js";
import { PublicError } from "./security.js";

export function createSecureUploadService({
  config,
  receive = receiveQuarantinedFile,
  validateContent = validateFileContent,
  scan = scanFileWithClamAv,
  publish = uploadFileToPinata,
  cleanup = removeQuarantine,
} = {}) {
  return {
    async process({ request, identity }) {
      const quarantined = await receive({ request, config, identity });
      try {
        await validateContent({ filePath: quarantined.filePath, identity });
        const scanResult = await scan({ config, filePath: quarantined.filePath });
        if (scanResult?.status !== "clean") {
          if (scanResult?.status === "infected") {
            throw new PublicError(422, "Upload rejected: malware was detected by the scanner.");
          }
          throw new PublicError(503, "Scanner could not reliably inspect the file. Upload blocked.");
        }
        const published = await publish({ config, identity, filePath: quarantined.filePath });
        return {
          cid: published.cid,
          uri: `ipfs://${published.cid}`,
          providerFileId: published.providerFileId || "",
          sha256: quarantined.sha256,
          scanStatus: "no-threats-detected",
        };
      } finally {
        await cleanup(quarantined.directory);
      }
    },
  };
}
