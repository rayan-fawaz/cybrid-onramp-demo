import { store } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const allData = store.getAll();
    const state: Record<string, string> = {};
    for (const row of allData) {
      state[row.key] = row.value;
    }
    return NextResponse.json({ success: true, state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const allData = store.getAll();
    for (const row of allData) {
      store.delete(row.key);
    }
    return NextResponse.json({
      success: true,
      message: "All stored data cleared. Ready for a fresh flow.",
      deleted_keys: allData.map((r) => r.key),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
