use russh::{client, Channel};

use crate::utils::{trace_debug, CLOSE_TIMEOUT};

pub(crate) struct StartupChannelCloseGuard {
    channel: Option<Channel<client::Msg>>,
}

impl StartupChannelCloseGuard {
    pub(crate) fn new(channel: Channel<client::Msg>) -> Self {
        Self {
            channel: Some(channel),
        }
    }

    pub(crate) fn channel(&self) -> &Channel<client::Msg> {
        self.channel
            .as_ref()
            .expect("startup channel guard missing channel")
    }

    pub(crate) fn channel_mut(&mut self) -> &mut Channel<client::Msg> {
        self.channel
            .as_mut()
            .expect("startup channel guard missing channel")
    }

    pub(crate) fn into_inner(mut self) -> Channel<client::Msg> {
        self.channel
            .take()
            .expect("startup channel guard missing channel")
    }

    pub(crate) async fn close(mut self) {
        if let Some(channel) = self.channel.take() {
            let channel_id: u32 = channel.id().into();
            trace_debug(format!(
                "startup-channel-close explicit channel={channel_id}"
            ));
            tokio::time::timeout(CLOSE_TIMEOUT, channel.close())
                .await
                .ok();
        }
    }
}

impl Drop for StartupChannelCloseGuard {
    fn drop(&mut self) {
        if let Some(channel) = self.channel.take() {
            let channel_id: u32 = channel.id().into();
            trace_debug(format!("startup-channel-close drop channel={channel_id}"));
            tokio::spawn(async move {
                tokio::time::timeout(CLOSE_TIMEOUT, channel.close())
                    .await
                    .ok();
            });
        }
    }
}
