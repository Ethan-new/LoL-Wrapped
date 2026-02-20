# frozen_string_literal: true

class Player < ApplicationRecord
  validates :puuid, presence: true, uniqueness: true
end
