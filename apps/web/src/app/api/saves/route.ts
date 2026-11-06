import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { masterPath, saveDir } from "../../../../../src/client/config.js";
import { SaveManager } from "../../../../../src/save/saveManager.js";
import { newGameSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function GET() {
  try {
    const saves = new SaveManager(masterPath, saveDir).list().map(({ filePath: _filePath, ...save }) => save);
    return NextResponse.json({ saves });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not list campaigns." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const input = newGameSchema.parse(await request.json());
    if (!existsSync(masterPath)) {
      return NextResponse.json({ error: "Master database is not initialized. Run npm run dev -- init-master in the project root." }, { status: 409 });
    }
    const save = await new SaveManager(masterPath, saveDir).create(input);
    const { filePath: _filePath, ...publicSave } = save;
    return NextResponse.json({ save: publicSave }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create campaign." }, { status: 400 });
  }
}
