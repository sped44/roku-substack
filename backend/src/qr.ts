import QRCode from "qrcode";

export async function renderPairQrPng(claimUrl: string): Promise<Buffer> {
  return QRCode.toBuffer(claimUrl, {
    type: "png",
    width: 420,
    margin: 2,
    errorCorrectionLevel: "M",
  });
}
