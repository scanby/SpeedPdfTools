import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { PDFDocument, PageSizes, StandardFonts, rgb } from 'pdf-lib';

async function createGraphicBannerPng(title: string, accentHex: string): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 680;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Uint8Array();

  const grad = ctx.createLinearGradient(0, 0, 1200, 680);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(1, '#1e293b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1200, 680);

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
  ctx.lineWidth = 1;
  for (let x = 60; x < 1200; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 680);
    ctx.stroke();
  }
  for (let y = 60; y < 680; y += 60) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1200, y);
    ctx.stroke();
  }

  ctx.fillStyle = accentHex;
  ctx.fillRect(80, 140, 12, 180);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 54px sans-serif';
  ctx.fillText(title, 120, 210);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '28px sans-serif';
  ctx.fillText('Documento de prueba local generado en el dispositivo', 120, 270);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) return new Uint8Array();
  return new Uint8Array(await blob.arrayBuffer());
}

export async function createSamplePdfFile(name = 'Informe_Corporativo_2026.pdf', pages = 3): Promise<File> {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const bannerBytes = await createGraphicBannerPng('SPEED.PDF — Muestra de Prueba', '#2563eb');
  const bannerImage = bannerBytes.byteLength > 0 ? await doc.embedPng(bannerBytes) : null;

  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage(PageSizes.A4);
    const { width, height } = page.getSize();

    page.drawText(`Informe Tecnico Local — Pagina ${i}`, {
      x: 54,
      y: height - 72,
      size: 20,
      font: bold,
      color: rgb(0.06, 0.09, 0.16),
    });

    page.drawText(
      'Este documento contiene texto seleccionable y graficos de alta resolucion para comprobar la compresion, union y conversion a Word o JPG sin subir datos a internet.',
      {
        x: 54,
        y: height - 110,
        size: 11,
        font: regular,
        color: rgb(0.2, 0.25, 0.33),
        maxWidth: width - 108,
        lineHeight: 16,
      }
    );

    if (bannerImage) {
      page.drawImage(bannerImage, {
        x: 54,
        y: height - 420,
        width: width - 108,
        height: 270,
      });
    }

    page.drawText(
      `Seccion ${i}.1: Arquitectura modular con procesamiento cifrado AES-256-GCM en el dispositivo del usuario.`,
      {
        x: 54,
        y: height - 470,
        size: 11,
        font: regular,
        color: rgb(0.15, 0.19, 0.25),
        maxWidth: width - 108,
      }
    );
  }

  const bytes = await doc.save({ useObjectStreams: false });
  return new File([new Uint8Array(bytes)], name, { type: 'application/pdf' });
}

export async function createSampleDocxFile(name = 'Propuesta_Comercial.docx'): Promise<File> {
  const wordDoc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun('Propuesta de Servicios SPEED.PDF')],
          }),
          new Paragraph({
            children: [
              new TextRun(
                'Este archivo Word (.docx) de ejemplo demuestra la conversion local directa a PDF sin servidores externos.'
              ),
            ],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun('Ventajas del procesamiento local')],
          }),
          new Paragraph({
            children: [
              new TextRun(
                '1. Privacidad absoluta: los contratos y anexos nunca abandonan tu equipo Windows.'
              ),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun(
                '2. Baja latencia: conversion instantanea desde el menu contextual del explorador.'
              ),
            ],
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(wordDoc);
  return new File([blob], name, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

export async function createSampleImageFile(name = 'Portada_AltaRes.jpg'): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 1000;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 1600, 1000);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(0.5, '#1e3a8a');
    grad.addColorStop(1, '#0f172a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1600, 1000);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 64px sans-serif';
    ctx.fillText('SPEED.PDF Workstation', 120, 440);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '32px sans-serif';
    ctx.fillText('Imagen de muestra lista para convertir a PDF local', 120, 510);
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  canvas.width = 0;
  canvas.height = 0;
  return new File([blob || new Blob()], name, { type: 'image/jpeg' });
}
