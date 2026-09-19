import { NextResponse } from "next/server";
import { corsHeaders } from "./cors";

export function successResponse<T>(
  data: T,
  status = 200,
) {
  return NextResponse.json(data, {
    status,
    headers: corsHeaders,
  });
}

export function errorResponse(
  message: string,
  status: number,
  code?: string,
  details?: unknown,
) {
  return NextResponse.json(
    {
      error: message,
      ...(code ? { code } : {}),
      ...(details !== undefined ? { details } : {}),
    },
    {
      status,
      headers: corsHeaders,
    },
  );
}
