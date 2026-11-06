import { NextResponse } from "next/server";
import { masterPath, saveDir } from "../../../../../src/client/config.js";
import { SaveManager } from "../../../../../src/save/saveManager.js";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ saveId: string }> }) {
  try {
    const { saveId } = await context.params;
    const db = new SaveManager(masterPath, saveDir).openById(saveId);
    db.close();
    return NextResponse.json({ opened: true, saveId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not open campaign." }, { status: 404 });
  }
}
