# frozen_string_literal: true

class RiotController < ApplicationController
  skip_before_action :allow_browser, raise: false

  def show
    path = Rails.root.join("public", "riot.txt")
    body = File.exist?(path) ? File.read(path) : ""
    response.headers["Cache-Control"] = "public, max-age=3600"
    render plain: body.strip, content_type: "text/plain"
  end
end
