import { RoomClient } from "../_components/room-client";

type PageProps = {
  params: Promise<{
    roomCode: string;
  }>;
};

export default async function SelectRolePage({ params }: PageProps) {
  const { roomCode } = await params;
  return <RoomClient roomCode={roomCode} mode="select-role" />;
}
