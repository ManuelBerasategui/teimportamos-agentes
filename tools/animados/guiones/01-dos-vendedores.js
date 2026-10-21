// "Dos vendedores. Mismo producto. Mismo precio. Uno gana 5 veces más." (mecánica del reel "dos restaurantes")
// Números de ejemplo: venta $60.000, comisión 15 % ($9.000), envío $5.000 → quedan $46.000.
// Vendedor 1 compra a un mayorista local a $40.000 → gana $6.000. Vendedor 2 lo trae de China a $15.000 → gana $31.000 (5 veces más).
cargar({ escenas: [
  { id: "dos", dur: 2.6, texto: "dos vendedores." },
  { id: "producto", dur: 2.6, texto: "mismo producto." },
  { id: "precio", dur: 2.6, texto: "mismo precio." },
  { id: "gana", dur: 3.4, texto: "pero uno gana *5 veces más.*" },
  { id: "pregunta", dur: 2.6, texto: "¿cómo puede ser?" },
  { id: "ml", dur: 4.2, texto: "los dos le pagan *igual* a Mercado Libre" },
  { id: "costo", dur: 4.6, texto: "la diferencia es *dónde compran*" },
  { id: "final", dur: 4.4, texto: "uno le compra al mayorista. el otro lo trae de *China*." },
  { id: "cta", dur: 4.0, texto: "¿cuánto te queda a vos?" },
] });

function dibujar(s, p, ps, t) {
  const id = s.id, idx = GUION.escenas.indexOf(s);
  const enEscena = (n) => idx >= GUION.escenas.findIndex((e) => e.id === n);
  // Título de cada escena arriba (aparece en cada corte, como el original)
  texto(s.texto, 300, s.id === "final" ? 84 : 108, ps / 0.5, { maxW: 960 });

  if (["dos", "producto", "precio", "gana", "pregunta"].includes(id)) {
    const pl = id === "dos" ? ps / 0.9 : 1;
    const gana = id === "gana" || id === "pregunta";
    local(W / 2 - 220, 1120, pl, { nombre: "Vendedor 1", gente: gana ? 2 : 0, t });
    local(W / 2 + 220, 1120, pl, { nombre: "Vendedor 2", toldo: P.ml, gente: gana ? Math.round(12 * ease((ps - 0.2) / 1.5)) + (id === "pregunta" ? 12 : 0) : 0, t });
    if (enEscena("producto")) { const pp = id === "producto" ? (ps - 0.3) / 0.7 : 1; producto(W / 2 - 220, 760, pp, "🔊", 90); producto(W / 2 + 220, 760, pp, "🔊", 90); }
    if (enEscena("precio")) { const pp = id === "precio" ? (ps - 0.3) / 0.6 : 1; etiqueta("$60.000", W / 2 - 220, 640, pp, P.tinta, "#fff", 44); etiqueta("$60.000", W / 2 + 220, 640, pp, P.tinta, "#fff", 44); }
    if (gana) { const pg = id === "gana" ? (ps - 0.4) / 1.6 : 1; monedas(W / 2 - 220, 1620, 2, pg); monedas(W / 2 + 220, 1620, 10, pg); }
    if (id === "pregunta") { x.save(); x.globalAlpha = 0.5 * ease(ps / 0.6); x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); x.restore(); texto("¿?", 1150, 360, ps / 0.5, { color: P.nar }); }
  }
  if (id === "ml") {
    // la cuenta de ML, igual para los dos
    const filas = [["Venta", "$60.000", P.tinta], ["Comisión 15 %", "− $9.000", P.rojo], ["Envío", "− $5.000", P.rojo], ["Les queda", "$46.000", P.verde]];
    caja(W / 2, 1050, 860, 620, 36, "#fff");
    filas.forEach(([a, b, c], i) => { const pf = (ps - 0.4 - i * 0.55) / 0.5; texto(a, 860 + i * 135, 54, pf, { alin: "left", x0: 190, peso: 700, color: P.gris }); texto(b, 860 + i * 135, 60, pf, { alin: "right", x0: 890, color: c }); });
    texto("(iguales para los dos)", 1460, 44, (ps - 2.8) / 0.5, { color: P.gris, peso: 700 });
  }
  if (id === "costo") {
    const pb = (ps - 0.5) / 1.4;
    barra(W / 2 - 220, 1560, 640, pb, "#94A3B8", "$40.000", "Vendedor 1 · mayorista local");
    barra(W / 2 + 220, 1560, 240, pb, P.nar, "$15.000", "Vendedor 2 · traído de China");
    texto("lo que les cuesta el producto", 560, 52, (ps - 0.2) / 0.5, { color: P.gris, peso: 700 });
  }
  if (id === "final") {
    const pb = (ps - 0.5) / 1.4;
    barra(W / 2 - 220, 1560, 120, pb, "#94A3B8", "$6.000", "gana Vendedor 1");
    barra(W / 2 + 220, 1560, 620, pb, P.verde, "$31.000", "gana Vendedor 2");
    texto("por cada venta", 640, 52, (ps - 0.2) / 0.5, { color: P.gris, peso: 700 });
  }
  if (id === "cta") {
    producto(W / 2, 820, ps / 0.6, "📦", 130);
    texto("Te traemos lo que vendés, por cantidad.", 1150, 64, (ps - 0.5) / 0.5, { maxW: 900 });
    etiqueta("Escribí MARGEN al WhatsApp", W / 2, 1420, (ps - 1.1) / 0.5, P.nar, "#fff", 48);
    texto("link en la bio", 1560, 44, (ps - 1.6) / 0.5, { color: P.gris, peso: 700 });
  }
}
