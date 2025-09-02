export function calcularTotalesReceta(ingredientesReceta, ingredientesBase) {
  // Normaliza acceso por id, acepte Map, Array o diccionario plano
  let getBaseById;

  if (ingredientesBase instanceof Map) {
    getBaseById = (id) => ingredientesBase.get(id);
  } else if (Array.isArray(ingredientesBase)) {
    const byId = new Map(ingredientesBase.map(i => [i.id, i]));
    getBaseById = (id) => byId.get(id);
  } else if (ingredientesBase && typeof ingredientesBase === 'object') {
    getBaseById = (id) => ingredientesBase[id];
  } else {
    getBaseById = () => undefined;
  }

  let totalCalorias = 0;
  let totalProteinas = 0;
  let totalPrecio = 0;

  (ingredientesReceta || []).forEach(ing => {
    const id = ing.ingrediente_id || ing?.ingrediente?.id || ing?.id;
    const base = getBaseById(id);

    if (!base) {
      console.warn(`⚠️ Ingrediente no encontrado: ${id}`);
      return;
    }

    const cantidad = parseFloat(ing.cantidad) || 0;

    // Si tu ficha base está referida a 100 g/ml, calorías y proteínas suelen venir por 100.
    const cantidadBase = base.cantidad || 100;

    const precioUnitario      = (parseFloat(base.precio)     || 0) / cantidadBase;
    const caloriasPorUnidad   = (parseFloat(base.calorias)   || 0) / 100;
    const proteinasPorUnidad  = (parseFloat(base.proteinas)  || 0) / 100;

    totalCalorias  += caloriasPorUnidad  * cantidad;
    totalProteinas += proteinasPorUnidad * cantidad;
    totalPrecio    += precioUnitario     * cantidad;
  });

  return {
    totalCalorias:  Math.round(totalCalorias),
    totalProteinas: Math.round(totalProteinas),
    totalPrecio:    parseFloat(totalPrecio.toFixed(2))
  };
}
