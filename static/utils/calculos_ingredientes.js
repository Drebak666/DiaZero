export function calcularTotalesReceta(ingredientesReceta, ingredientesBase) {
  let totalCalorias = 0;
  let totalProteinas = 0;
  let totalPrecio = 0;

  ingredientesReceta.forEach(ing => {
    const id = ing.ingrediente_id || ing.ingrediente?.id || ing.id;
    const base = ingredientesBase.find(i => i.id === id);

    if (!base) {
      console.warn(`⚠️ Ingrediente no encontrado: ${id}`);
      return;
    }

    const cantidad = parseFloat(ing.cantidad) || 0;
    const cantidadBase = base.cantidad || 100;

    const precioUnitario = (base.precio || 0) / cantidadBase;
    const caloriasPorUnidad = (base.calorias || 0) / 100;
    const proteinasPorUnidad = (base.proteinas || 0) / 100;

    totalCalorias += caloriasPorUnidad * cantidad;
    totalProteinas += proteinasPorUnidad * cantidad;
    totalPrecio += precioUnitario * cantidad;
  });

  return {
    totalCalorias: Math.round(totalCalorias),
    totalProteinas: Math.round(totalProteinas),
    totalPrecio: parseFloat(totalPrecio.toFixed(2))
  };
}
