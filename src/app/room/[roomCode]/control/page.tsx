import { RoomClient } from "../_components/room-client";

type PageProps = {
  params: Promise<{
    roomCode: string;
  }>;
};

export default async function ControlPage({ params }: PageProps) {
  const { roomCode } = await params;
  return <RoomClient roomCode={roomCode} mode="control" />;
}
