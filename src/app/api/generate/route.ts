import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt, source, width, height, seed } = body;

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    if (source === "pollinations") {
      const w = width || 512;
      const h = height || 512;
      const randomSeed = seed || Math.floor(Math.random() * 999999999);

      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&nologo=true&seed=${randomSeed}`;

      // Fetch the image from Pollinations.ai
      const imageResponse = await fetch(imageUrl, {
        headers: {
          "User-Agent": "AnimeAIStudio/1.0",
          Accept: "image/jpeg,image/png,image/webp,*/*",
        },
      });

      if (!imageResponse.ok) {
        return NextResponse.json(
          {
            error: `Failed to fetch image from Pollinations.ai (status: ${imageResponse.status})`,
          },
          { status: 502 }
        );
      }

      const imageBuffer = await imageResponse.arrayBuffer();
      const base64 = Buffer.from(imageBuffer).toString("base64");

      const contentType = imageResponse.headers.get("content-type") || "image/jpeg";

      return NextResponse.json({
        image: `data:${contentType};base64,${base64}`,
        source: "pollinations",
        prompt,
        width: w,
        height: h,
        seed: randomSeed,
      });
    }

    if (source === "aianime") {
      // Since aianime.io blocks server-side calls, return instructions
      // for the client to make the call directly
      return NextResponse.json({
        directCall: {
          url: "https://api.aianime.io/api/image-generate/text2image",
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: `prompt=${encodeURIComponent(prompt)}&model_type=anime_io`,
        },
        source: "aianime",
        prompt,
      });
    }

    return NextResponse.json({ error: "Invalid source" }, { status: 400 });
  } catch (error) {
    console.error("Generate API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
