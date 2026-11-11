import { TablaRemota } from "../../components/datos/TablaRemota";

const etiquetas = {
  dominio: "Dominio",
  marca_modelo: "Marca / modelo",
  equipo: "Equipo",
  estado: "Estado",
  titularidad: "Titularidad",
  venc_seguro: "Vencimiento seguro",
  venc_patente: "Vencimiento patente",
};

export default function AdminPanel() {
  return <TablaRemota tabla="vehiculos" titulo="Unidades" etiquetas={etiquetas} orden="dominio" agruparPor="estado" />;
}
