import { DriverDetailClient } from "./DriverDetailClient";

export function generateStaticParams() {
  const drivers = ["1", "4", "16", "44", "63", "55", "12", "81", "14", "18", "10", "23", "27", "31", "87", "22", "30", "5", "6", "7"];
  return drivers.map((driver) => ({ driver }));
}

export default async function DriverDetailPage({
  params,
}: {
  params: Promise<{ driver: string }>;
}) {
  const { driver } = await params;
  return <DriverDetailClient driverParam={driver} />;
}
