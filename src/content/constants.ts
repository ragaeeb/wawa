// Public web-client constants used by X's frontend APIs.
// These are not secrets and are expected to be present in client-side code.
export const BEARER_TOKEN =
    'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

export const USER_BY_SCREEN_NAME_FEATURES = {
    hidden_profile_likes_enabled: false,
    hidden_profile_subscriptions_enabled: false,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    subscriptions_verification_info_is_identity_verified_enabled: false,
    subscriptions_verification_info_verified_since_enabled: false,
    highlights_tweets_tab_ui_enabled: false,
    responsive_web_twitter_article_notes_tab_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: false,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: false,
};

export const USER_BY_SCREEN_NAME_FIELD_TOGGLES = {
    withAuxiliaryUserLabels: false,
};

export const TIMELINE_FEATURES = {
    rweb_video_screen_enabled: false,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: false,
    rweb_tipjar_consumption_enabled: false,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    premium_content_api_read_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    responsive_web_grok_analyze_button_fetch_trends_enabled: false,
    responsive_web_grok_analyze_post_followups_enabled: true,
    responsive_web_jetfuel_frame: true,
    responsive_web_grok_share_attachment_enabled: true,
    responsive_web_grok_annotations_enabled: false,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    responsive_web_grok_show_grok_translated_post: false,
    responsive_web_grok_analysis_button_from_backend: true,
    post_ctas_fetch_enabled: true,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_grok_image_annotation_enabled: true,
    responsive_web_grok_imagine_annotation_enabled: true,
    responsive_web_grok_community_note_auto_translation_is_enabled: false,
    responsive_web_enhance_cards_enabled: false,
};

export const TIMELINE_FIELD_TOGGLES = {
    withArticlePlainText: false,
};

export const ENDPOINTS = {
    userByScreenName: {
        id: 'NimuplG1OB7Fd2btCLdBOw',
        path: 'UserByScreenName',
    },
    userTweets: {
        id: 'a3SQAz_VP9k8VWDr9bMcXQ',
        path: 'UserTweets',
    },
    userTweetsAndReplies: {
        id: 'NullQbZlUJl-u6oBYRdrVw',
        path: 'UserTweetsAndReplies',
    },
    tweetResultByRestId: {
        id: 'D8ca9i84NQLKeqq5Sry-tg',
        path: 'TweetResultByRestId',
    },
    tweetDetail: {
        id: 'Kzfv17rukSzjT96BerOWZA',
        path: 'TweetDetail',
    },
    searchTimeline: {
        // Multiple fallback IDs - these rotate frequently
        ids: ['f_A-Gyo204PRxixpkrchJg', 'AIdc203rPpK_k_2KWSdm7g', 'VhUd6vHVmLBcw0uX-6jMLA', '6AAys3t42mosm_yTI_QENg'],
        id: null as null | string,
        path: 'SearchTimeline',
    },
};
