module ApplicationHelper
  def player_path(player, **options)
    url_helpers.player_path(**player.path_params, **options)
  end

  def player_url(player, **options)
    options = request_host_options.merge(options)
    url_helpers.player_url(**player.path_params, **options)
  end

  private

  def url_helpers
    Rails.application.routes.url_helpers
  end

  def request_host_options
    return {} unless respond_to?(:request) && request
    opts = { host: request.host }
    opts[:port] = request.port unless [ 80, 443 ].include?(request.port)
    opts
  end
end
