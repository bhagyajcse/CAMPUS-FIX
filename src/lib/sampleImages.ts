export interface SamplePhotoPreset {
  id: string;
  label: string;
  suggestedDescription: string;
  suggestedLocation: { block: string; floor: string; room: string };
}

export const SAMPLE_PHOTO_PRESETS: SamplePhotoPreset[] = [
  {
    id: 'projector',
    label: 'Broken Projector',
    suggestedDescription: 'The ceiling projector in Block A Room 204 is not turning on and shows a blinking red lamp LED.',
    suggestedLocation: { block: 'Block A', floor: '2nd Floor', room: '204' },
  },
  {
    id: 'tap',
    label: 'Leaking Washroom Tap',
    suggestedDescription: 'Water tap in Block B 1st floor washroom is leaking continuously.',
    suggestedLocation: { block: 'Block B', floor: '1st Floor', room: 'Washroom 1B' },
  },
  {
    id: 'wire',
    label: 'Exposed Electrical Wire',
    suggestedDescription: 'Damaged electrical conduit with exposed live copper wires and spark marks near wall switch in Block C 101.',
    suggestedLocation: { block: 'Block C', floor: 'Ground Floor', room: '101' },
  },
  {
    id: 'fan',
    label: 'Faulty Classroom Fan',
    suggestedDescription: 'Classroom ceiling fan in Block A Room 204 has a bent blade and is wobbling.',
    suggestedLocation: { block: 'Block A', floor: '2nd Floor', room: '204' },
  },
  {
    id: 'router',
    label: 'Faulty Wi-Fi Router',
    suggestedDescription: 'Wi-Fi access point router in Block B Room 301 has a red error LED and no campus internet.',
    suggestedLocation: { block: 'Block B', floor: '3rd Floor', room: '301' },
  },
];

export function renderSampleFacilityPng(kind: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Clean architectural room backdrop
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(0, 0, 640, 480);

  // Subtle wall gradient
  const grad = ctx.createLinearGradient(0, 0, 0, 480);
  grad.addColorStop(0, '#f1f5f9');
  grad.addColorStop(1, '#cbd5e1');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 640, 480);

  if (kind === 'projector') {
    // Ceiling mount
    ctx.fillStyle = '#475569';
    ctx.fillRect(305, 0, 30, 120);
    ctx.fillRect(265, 115, 110, 14);
    // Projector chassis
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(150, 130, 340, 130, 14);
    ctx.fill();
    ctx.stroke();
    // Lens
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(235, 195, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(235, 195, 26, 0, Math.PI * 2);
    ctx.fill();
    // Red error LED
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.arc(435, 165, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#991b1b';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('LAMP ERR', 395, 200);
    // Loose hanging HDMI cable
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(420, 260);
    ctx.bezierCurveTo(440, 340, 340, 370, 365, 430);
    ctx.stroke();
    ctx.fillStyle = '#64748b';
    ctx.fillRect(353, 424, 24, 26);
  } else if (kind === 'tap') {
    // Tiled wall
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    for (let x = 0; x < 640; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 340);
      ctx.stroke();
    }
    for (let y = 0; y < 340; y += 60) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(640, y);
      ctx.stroke();
    }
    // Porcelain sink basin
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(120, 300, 400, 120, 20);
    ctx.fill();
    ctx.stroke();
    // Chrome faucet body
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(295, 180, 50, 120);
    ctx.beginPath();
    ctx.arc(320, 180, 55, Math.PI, 0);
    ctx.lineWidth = 28;
    ctx.strokeStyle = '#94a3b8';
    ctx.stroke();
    // Leaking water stream + droplets
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(256, 205, 10, 95);
    ctx.beginPath();
    ctx.arc(261, 240, 9, 0, Math.PI * 2);
    ctx.arc(261, 285, 11, 0, Math.PI * 2);
    ctx.fill();
    // Water puddle
    ctx.fillStyle = 'rgba(37, 99, 235, 0.35)';
    ctx.beginPath();
    ctx.ellipse(290, 345, 125, 22, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'wire') {
    // Concrete wall background
    ctx.fillStyle = '#d6d3d1';
    ctx.fillRect(0, 0, 640, 480);
    // Cracked electrical junction box
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 4;
    ctx.fillRect(210, 120, 220, 210);
    ctx.strokeRect(210, 120, 220, 210);
    // Crack & scorch mark
    ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.beginPath();
    ctx.arc(320, 225, 65, 0, Math.PI * 2);
    ctx.fill();
    // Exposed red, black, and bare copper wires
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#dc2626';
    ctx.beginPath();
    ctx.moveTo(295, 220);
    ctx.bezierCurveTo(250, 270, 210, 320, 240, 390);
    ctx.stroke();

    ctx.strokeStyle = '#0f172a';
    ctx.beginPath();
    ctx.moveTo(325, 220);
    ctx.bezierCurveTo(360, 280, 420, 310, 395, 385);
    ctx.stroke();

    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(310, 230);
    ctx.lineTo(310, 360);
    ctx.stroke();
    // Spark icon
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.moveTo(310, 340);
    ctx.lineTo(325, 365);
    ctx.lineTo(312, 365);
    ctx.lineTo(322, 395);
    ctx.lineTo(295, 362);
    ctx.lineTo(308, 362);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'fan') {
    // Ceiling tiles
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    for (let x = 0; x < 640; x += 160) {
      ctx.strokeRect(x, 0, 160, 140);
    }
    // Tilted downrod
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(320, 0);
    ctx.lineTo(334, 195);
    ctx.stroke();
    // Motor hub
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(334, 215, 58, 28, 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Straight blade left
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(278, 212);
    ctx.lineTo(105, 196);
    ctx.lineTo(105, 224);
    ctx.lineTo(278, 226);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Visibly bent blade right
    ctx.beginPath();
    ctx.moveTo(390, 215);
    ctx.lineTo(485, 240);
    ctx.lineTo(545, 315);
    ctx.lineTo(525, 330);
    ctx.lineTo(465, 260);
    ctx.lineTo(385, 232);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (kind === 'router') {
    // Wall mount Wi-Fi AP
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(190, 140, 260, 160, 24);
    ctx.fill();
    ctx.stroke();
    // Antennas
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(225, 65, 14, 75);
    ctx.fillRect(401, 65, 14, 75);
    // Red fault LED
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.arc(320, 220, 16, 0, Math.PI * 2);
    ctx.fill();
    // Disconnected Ethernet cable dangling
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(320, 300);
    ctx.bezierCurveTo(320, 360, 270, 385, 280, 445);
    ctx.stroke();
  } else {
    // Repaired cleanly sample
    ctx.fillStyle = '#ecfdf5';
    ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = '#16a34a';
    ctx.beginPath();
    ctx.arc(320, 215, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(285, 215);
    ctx.lineTo(310, 242);
    ctx.lineTo(360, 190);
    ctx.stroke();
    ctx.fillStyle = '#065f46';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('REPAIR COMPLETED & VERIFIED', 320, 330);
  }

  return canvas.toDataURL('image/png');
}
