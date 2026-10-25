#!/bin/sh
# Restart the system app manager (sam) so it picks up the replaced Home or new apps, then the media server with it.
# The media server (umediaserver) learns which app is in front from sam; after a sam restart alone it treats no app as
# in front, so no video is ever connected to the screen: apps and HDMI inputs play behind a black picture until a reboot.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
# an airplay child of sam makes the stop wait ~90 s; kill it once the stop has begun
(sleep 3; pkill -9 -f /usr/palm/applications/airplay/LunaExecutable) </dev/null >/dev/null 2>&1 &
systemctl restart sam
for i in $(seq 1 60); do systemctl is-active sam >/dev/null && break; sleep 2; done
systemctl restart umediaserver
