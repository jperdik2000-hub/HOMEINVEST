import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listNights from "./tools/list-nights";
import getNightResults from "./tools/get-night-results";
import myStats from "./tools/my-stats";
import leaderboard from "./tools/leaderboard";
import mySettlements from "./tools/my-settlements";

// The OAuth issuer must be the direct Supabase host; the project ref is the
// only value that survives publish unchanged.
const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "poker-club",
  title: "Poker Club",
  version: "0.1.0",
  instructions:
    "Tools for the Poker Club app. Use list_poker_nights to find games, get_night_results for a night's results, get_my_stats and get_leaderboard for performance, and get_my_settlements for money owed. All tools act as the signed-in user.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listNights, getNightResults, myStats, leaderboard, mySettlements],
});
