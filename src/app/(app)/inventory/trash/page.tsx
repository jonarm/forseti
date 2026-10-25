import { permanentRedirect } from "next/navigation";

/**
 * The inventory's trash, which is now everybody's.
 *
 * This URL existed while systems were the only register with a retention
 * window. Seven more grew one and eight trash screens would have been seven copies
 * of a countdown — so the page moved to `/trash` and gained a tab per register.
 *
 * Kept as a redirect rather than deleted: it is a URL somebody has bookmarked,
 * and a 404 on a governance screen reads as the feature having been taken away
 * rather than moved. `permanentRedirect` sends a 308, so a browser that has
 * been here before stops asking.
 */
export default function InventoryTrashPage(): never {
  permanentRedirect("/trash");
}
