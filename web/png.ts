const PAD = 16;
const SCALE = 2;

export async function svgToPng(svg: string, colors: { fg: string; bg: string }): Promise<Blob> {
  const themed = svg
    .replace("<svg ", `<svg style="color:${colors.fg}" `)
    .replace("<defs>", `<defs><style>.mid-box,.mid-label-bg{fill:${colors.bg}}</style>`);
  const url = URL.createObjectURL(new Blob([themed], { type: "image/svg+xml" }));
  const img = new Image();
  try {
    img.src = url;
    await img.decode();
  } finally {
    URL.revokeObjectURL(url);
  }

  const canvas = document.createElement("canvas");
  canvas.width = (img.width + PAD * 2) * SCALE;
  canvas.height = (img.height + PAD * 2) * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(SCALE, SCALE);
  ctx.drawImage(img, PAD, PAD);
  return await new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG export failed"))),
      "image/png",
    ),
  );
}
