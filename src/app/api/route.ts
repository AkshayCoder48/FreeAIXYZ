import { NextResponse } from "next/server";
import { withCors, corsPreflight } from "@/lib/api/cors";

export async function GET(): Promise<Response> {
  return withCors(await apiRoot());
}

/** CORS preflight. */
export async function OPTIONS(): Promise<Response> {
  return corsPreflight();
}

async function apiRoot(): Promise<Response> {
  return NextResponse.json({ message: "Hello, world!" });
}