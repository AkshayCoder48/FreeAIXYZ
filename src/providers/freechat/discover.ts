/**
 * FreeChat discoverer — `https://llmproxy.org/api/chat.php` is a chat
 * endpoint with NO /models listing (404 on /v1/models). Single upstream
 * model id `v3` works.
 */
import { manualModels } from "../_shared";

const IDS = ["v3"];

export async function discover() {
  return manualModels(IDS, {
    source: "manual",
    endpoint: "https://llmproxy.org/api/chat.php",
    note: "freechat has no /models endpoint; single slug v3",
  });
}
