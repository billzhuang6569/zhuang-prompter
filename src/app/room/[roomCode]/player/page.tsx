import { RoomClient } from "../_components/room-client";

type PageProps = {
  params: Promise<{
    roomCode: string;
  }>;
};

export default async function PlayerPage({ params }: PageProps) {
  const { roomCode } = await params;
  return <RoomClient roomCode={roomCode} mode="player" />;
}
