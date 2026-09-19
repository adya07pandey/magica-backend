import { NextResponse } from "next/server";
import { getCurrentUser } from "@/src/modules/auth/current-user";
import { corsHeaders } from "@/src/lib/cors";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        error: "Unauthorized",
      },
      {
        status: 401,
        headers: corsHeaders,
      },
    );
  }

  return NextResponse.json(
    {
      id: user.id,
      clerkUserId: user.clerkUserId,
      name: user.name,
      email: user.email,
    },
    {
      headers: corsHeaders,
    },
  );
}
