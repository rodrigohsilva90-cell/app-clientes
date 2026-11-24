// Cálculo exato de distância em metros entre duas coordenadas (Fórmula de Haversine)
export function calcularDistanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Raio da Terra em metros
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

// Calcula o ângulo de direção (Bearing) para girar o ícone da moto na direção da rua
export function calcularAnguloDirecao(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Valida se o entregador está dentro do raio permitido (100m + margem de precisão do GPS)
export function validarCercaEntrega(motoCoords, destinoCoords, raioBaseMetros = 100) {
  const distancia = calcularDistanciaMetros(
    motoCoords.lat,
    motoCoords.lng,
    destinoCoords.lat,
    destinoCoords.lng
  );
  const margemPrecisao = Math.min(Number(motoCoords.accuracy) || 0, 40); // Limita tolerância extra a 40m
  const limiteEfetivo = raioBaseMetros + margemPrecisao;

  return {
    permitido: distancia <= limiteEfetivo,
    distanciaMetros: distancia,
    limiteEfetivo
  };
}

// Inicializa o mapa Leaflet com OpenStreetMap padrão oficial
export function criarMapaRastreamento(elementId, centroCoords, zoom = 15) {
  const map = L.map(elementId).setView([centroCoords.lat, centroCoords.lng], zoom);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  return map;
}

// Cria marcador customizado da moto com suporte a rotação e deslizamento suave (interpolação)
export function criarMarcadorMoto(map, coordsIniciais) {
  const motoIcon = L.divIcon({
    className: 'moto-marker-wrapper',
    html: `<div id="moto-icon-rotor" style="font-size:28px; transition: transform 0.5s ease; transform-origin: center;">🛵</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });

  const marker = L.marker([coordsIniciais.lat, coordsIniciais.lng], { icon: motoIcon }).addTo(map);
  let posAtual = { ...coordsIniciais };
  let animFrame = null;

  function moverSuavemente(novasCoords, duracaoMs = 2000) {
    if (animFrame) cancelAnimationFrame(animFrame);

    const angulo = calcularAnguloDirecao(posAtual.lat, posAtual.lng, novasCoords.lat, novasCoords.lng);
    const rotor = document.getElementById('moto-icon-rotor');
    if (rotor && (posAtual.lat !== novasCoords.lat || posAtual.lng !== novasCoords.lng)) {
      rotor.style.transform = `rotate(${angulo}deg)`;
    }

    const inicioLat = posAtual.lat;
    const inicioLng = posAtual.lng;
    const deltaLat = novasCoords.lat - inicioLat;
    const deltaLng = novasCoords.lng - inicioLng;
    const inicioTempo = performance.now();

    function step(agora) {
      const progresso = Math.min((agora - inicioTempo) / duracaoMs, 1);
      const lat = inicioLat + deltaLat * progresso;
      const lng = inicioLng + deltaLng * progresso;
      marker.setLatLng([lat, lng]);

      if (progresso < 1) {
        animFrame = requestAnimationFrame(step);
      } else {
        posAtual = { ...novasCoords };
      }
    }

    animFrame = requestAnimationFrame(step);
  }

  return { marker, moverSuavemente };
}
