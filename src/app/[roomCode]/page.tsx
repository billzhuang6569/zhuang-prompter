import { notFound, redirect } from "next/navigation";

type PageProps = {
  params: Promise<{
    roomCode: string;
  }>;
};

// 短链根路由（§12.2）：让 `http://<主机>:<端口>/123456` 直接进入播放端，
// 免去 /room/.../player 这一长路径。仅接受 6 位数字房间号，其余交回 404，
// 因此不会遮蔽 /room、/join、/api 等既有静态路由。
export default async function ShortLinkPage({ params }: PageProps) {
  const { roomCode } = await params;
  if (!/^\d{6}$/.test(roomCode)) {
    notFound();
  }
  redirect(`/room/${roomCode}/player`);
}
